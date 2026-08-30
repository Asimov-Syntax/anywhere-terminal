// src/worktree/removalChecks.ts — The removal assessment, as the wire carries it.
//
// The host has always computed something richer than it sent. `evaluateRemoval`
// returns a three-member union that knows the difference between "there is no
// risk" and "the risk could not be read"; the wire flattened it to a record of
// booleans and counts, on which those two are indistinguishable. This projects
// the assessment onto the check model instead (worktree-rpc.md § 2.5).
//
// It INVENTS nothing. Every check here has a source in the assessment already,
// and `notApplicable` is produced only where a source said its question did not
// arise — never as a default for a check this module did not compute.

import type { RemovalCheck, RemovalCheckClass } from "../types/messages";
import type { IgnoredMaterial } from "./ignoredMaterial";
import type { ProofOutcome } from "./orphanProofs";
import type { RemovalAssessment, UnreadableSource } from "./worktreeBlockers";

/**
 * Every check the model can report, with the class that decides what its failure
 * costs (worktree-removal.md § 2.2), and the source whose failure leaves it
 * unproven.
 *
 * Declared as one table rather than assembled per assessment kind so that
 * "which checks exist" has a single answer — a check that appears in one branch
 * and not another is how a UI ends up rendering a shorter list for a worse
 * outcome.
 */
/**
 * What a check's failure costs.
 *
 * Constant for every check but one. `externalAgents` refuses when the session is
 * running, waiting, or undeterminable and is confirmable only when it is provably
 * idle (worktree-removal.md § 2.2), so its class is a property of the EVIDENCE
 * rather than of the id — and `cls` is what decides whether a typed confirmation
 * can authorize the removal, which is why § 2.5 puts it on the wire instead of
 * letting the webview re-derive it.
 *
 * A function, not a second check id: two ids would make the check list differ by
 * outcome, which is the failure this one-row-per-id table exists to prevent.
 */
type ClassOf = RemovalCheckClass | ((assessment: RemovalAssessment) => RemovalCheckClass);

const CATALOGUE: readonly { id: string; cls: ClassOf; source?: UnreadableSource }[] = [
  { id: "isMain", cls: "refusal", source: "listing" },
  { id: "busyAgents", cls: "refusal", source: "sessions" },
  { id: "containsWorktrees", cls: "refusal", source: "listing" },
  { id: "dirty", cls: "confirmable", source: "status" },
  { id: "untracked", cls: "confirmable", source: "status" },
  { id: "idlePanes", cls: "confirmable", source: "sessions" },
  // Refusal-class throughout a refused assessment: `cls` answers "could a
  // confirmation authorize this", and in a refusal nothing can be authorized at
  // all — which is why every check in that branch carries the refusal class.
  { id: "externalAgents", cls: (a) => (a.kind === "refused" ? "refusal" : "confirmable"), source: "sessions" },
  { id: "locked", cls: "confirmable", source: "status" },
  // Confirmable in EVERY reading, including the one that could not finish: § 2.3
  // is explicit that a slow or unreadable disk must not make a worktree
  // unremovable, and a refusal class here would do exactly that.
  { id: "ignored", cls: "confirmable", source: "ignored" },
  // The three proofs of worktree-removal.md § 4. No `source`: each reads a place
  // no other check does — the lock file, the registry records the live filter
  // discards, and local refs — so no `UnreadableSource` names why one is
  // unproven, and attaching the nearest one would blame a read it never took.
  // They carry their own four-way outcome instead of a boolean, which is why
  // `check` is not what builds them.
  { id: "lockAged", cls: "proof" },
  { id: "ownerGone", cls: "proof" },
  { id: "branchMerged", cls: "proof" },
];

/** The whole catalogue, every check unproven. */
function allUnproven(unreadable: readonly UnreadableSource[], assessment: RemovalAssessment): readonly RemovalCheck[] {
  const named = new Set(unreadable);
  return CATALOGUE.map((entry) => ({
    id: entry.id,
    cls: classOf(entry.cls, assessment),
    outcome: "unproven" as const,
    // An `unavailable` assessment carries no evidence at all, so no check can be
    // reported as passed — not only the ones whose own source failed. Naming the
    // sources that did fail is what keeps the report honest about which of them
    // is the reason.
    ...(entry.source !== undefined && named.has(entry.source)
      ? { detail: `The ${entry.source} could not be read.` }
      : {}),
  }));
}

function classOf(cls: ClassOf, assessment: RemovalAssessment): RemovalCheckClass {
  return typeof cls === "function" ? cls(assessment) : cls;
}

function check(id: string, assessment: RemovalAssessment, failed: boolean, count?: number): RemovalCheck {
  const entry = CATALOGUE.find((e) => e.id === id);
  if (entry === undefined) {
    throw new Error(`"${id}" is not a removal check.`);
  }
  const cls = classOf(entry.cls, assessment);
  // A source whose question did not arise yields neither a pass nor a failure.
  // No count rides on it either: the panel renders `count` inside its own
  // element as a reading that was taken, and nobody took this one.
  if (
    assessment.kind === "confirmable" &&
    entry.source !== undefined &&
    assessment.evidence.notApplicable.includes(entry.source)
  ) {
    return { id, cls, outcome: "notApplicable" };
  }
  return {
    id,
    cls,
    outcome: failed ? "failed" : "passed",
    ...(count === undefined ? {} : { count }),
  };
}

/**
 * The assessment, as checks. Total over the three kinds `evaluateRemoval`
 * returns.
 *
 * A `refused` assessment reports only the refusal-class checks: it carries no
 * evidence, because nothing about the confirmable risk was gathered once the
 * removal was already refused. Reporting the confirmable ones as `passed` there
 * would claim a check ran that never did.
 */
export function checksFor(assessment: RemovalAssessment): readonly RemovalCheck[] {
  switch (assessment.kind) {
    case "unavailable":
      return allUnproven(assessment.unreadable, assessment);
    case "refused": {
      const live = assessment.liveExternalSessionIds.length;
      return [
        check("isMain", assessment, assessment.isMain),
        check("busyAgents", assessment, assessment.busyAgents > 0, assessment.busyAgents),
        check(
          "containsWorktrees",
          assessment,
          assessment.containsWorktrees.length > 0,
          assessment.containsWorktrees.length,
        ),
        // Reported even when the refusal came from elsewhere: the sessions WERE
        // read, and a check that ran and found nothing is a different report
        // from one omitted. It is refusal-class here only when it is the check
        // doing the refusing.
        check("externalAgents", assessment, live > 0, live),
      ];
    }
    case "confirmable": {
      const e = assessment.evidence;
      return [
        check("isMain", assessment, false),
        check("busyAgents", assessment, false, 0),
        check("containsWorktrees", assessment, false, 0),
        check("dirty", assessment, e.dirtyPaths.length > 0, e.dirtyPaths.length),
        check("untracked", assessment, e.untrackedPaths.length > 0, e.untrackedPaths.length),
        check("idlePanes", assessment, e.paneIds.length > 0, e.paneIds.length),
        check("externalAgents", assessment, e.externalSessionIds.length > 0, e.externalSessionIds.length),
        check("locked", assessment, e.locked),
        ignoredCheck(e.ignored),
        // Only here. A `refused` assessment gathered no evidence about them, and
        // reporting them there would claim checks that never ran (design.md D1).
        proofCheck("lockAged", e.proofs.lockAged),
        proofCheck("ownerGone", e.proofs.ownerGone),
        proofCheck("branchMerged", e.proofs.branchMerged),
      ];
    }
  }
}

/**
 * One proof, as a check.
 *
 * A pass-through, deliberately: `ProofOutcome` and `RemovalCheckOutcome` agree
 * today and are declared apart so a change to one does not silently redefine the
 * other. The class is constant — a proof withholds only the option it gates, so
 * it can never be the reason a removal is refused (worktree-removal.md § 2.2).
 */
function proofCheck(id: string, outcome: ProofOutcome): RemovalCheck {
  return { id, cls: "proof", outcome };
}

/**
 * The ignored walk, as a check.
 *
 * Its own builder because it is the one check with a three-way source: `check`
 * takes a boolean, and a walk that gave up is neither a pass nor a failure. The
 * size rides in `detail` rather than as a second magnitude — `count` is the
 * entries, which is what the panel's clause is keyed on — and NOTHING rides on
 * an unproven walk at all.
 */
function ignoredCheck(material: IgnoredMaterial): RemovalCheck {
  const cls = "confirmable" as const;
  if (material.kind === "unproven") {
    return {
      id: "ignored",
      cls,
      outcome: "unproven",
      detail:
        material.reason === "budget"
          ? "Too much ignored content to measure in time."
          : "The ignored content could not be read.",
    };
  }
  if (material.entries === 0) {
    // A walk that finished and found none. No count: `countOf` refuses to read
    // one off a passed check, and attaching it anyway leaves the number there
    // for the next producer to render.
    return { id: "ignored", cls, outcome: "passed" };
  }
  const provisioned = material.provisioned;
  return {
    id: "ignored",
    cls,
    outcome: "failed",
    count: material.entries,
    detail:
      formatBytes(material.bytes) +
      // Said only from the manifest. Its absence is how "we did not
      // differentiate" is expressed, and a zero would claim we looked.
      (provisioned === undefined ? "" : `, ${provisioned.entries} of it provisioned by this extension`),
  };
}

/** One decimal, binary units — the size a person reads before confirming a delete. */
function formatBytes(bytes: number): string {
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} ${units[unit]}` : `${value.toFixed(1)} ${units[unit]}`;
}

/** Does any refusal-class check stand? No confirmation can authorize this removal. */
export function isRefusedByChecks(checks: readonly RemovalCheck[]): boolean {
  return checks.some((c) => c.cls === "refusal" && c.outcome === "failed");
}

/**
 * The magnitude a check actually measured, or 0 — the shape the panel's clauses
 * are keyed on.
 *
 * Only a `failed` check yields one. A count riding an `unproven` check is a
 * number nobody measured, and the panel renders it inside a `<b>`: "2 untracked
 * files" reads as a reading that was taken. `checksFor` attaches no count to an
 * unproven check, so this moves no reachable rendering — it stops the next
 * producer from being able to (round-1 W2).
 */
export function countOf(checks: readonly RemovalCheck[], id: string): number {
  const found = checks.find((c) => c.id === id);
  return found?.outcome === "failed" ? (found.count ?? 0) : 0;
}

/** Did this check fail? Unproven is not failed, and must not render as passed either. */
export function failed(checks: readonly RemovalCheck[], id: string): boolean {
  return checks.find((c) => c.id === id)?.outcome === "failed";
}
