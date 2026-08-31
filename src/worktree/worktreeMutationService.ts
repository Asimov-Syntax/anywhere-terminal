// src/worktree/worktreeMutationService.ts — The five mutating capabilities, as
// production actually gets them.
//
// Every verb in `worktreeMutations.ts` is a pure function over a git runner, and
// every safety component — the queue, the coordinator, the blocker evaluator,
// the fingerprint store, the create-path validator — is independently
// constructible. Round-1 B1 was that nothing assembled them: the host declared
// all five capabilities optional and the only production factory supplied none,
// so Lock and Remove were inert and Create and Prune were unreachable. This
// module is that assembly, and the one place the ordering rules live.

import type { WorktreeMutationCapabilities, WorktreeMutationTarget, WorktreeSurface } from "../providers/WorktreeHost";
import type { WorktreeAfterCreate, WorktreeCreateMode } from "../types/messages";
import { normalizePathForCompare } from "../utils/pathBoundary";
import { type CreatePathContext, type CreatePathDeps, identityOf, intentFor, validateCreatePath } from "./createPath";
import type { GitCommandRunner } from "./gitCommandRunner";
import { excludePatternFor } from "./gitExclude";
import { createMutationCoordinator, type MutationCoordinator, type MutationSettle } from "./mutationCoordinator";
import { createMutationQueue } from "./mutationQueue";
import type { ReattachVerdict } from "./reattachProbe";
import type { RemovalAssessment, RemovalEvidence } from "./worktreeBlockers";
import { createFingerprintStore, type FingerprintStore } from "./worktreeFingerprint";
import {
  branchNameIsValid,
  type CreateSource,
  classifyRemoval,
  createWorktree,
  lockWorktree,
  type MutationResult,
  pruneRepo,
  type RemovalOutcome,
  removeWorktree,
  repairWorktree,
  unlockWorktree,
} from "./worktreeMutations";

/**
 * What an id names once the tree has been rebuilt.
 *
 * `incarnation` is what does NOT survive a remove-and-recreate at the same
 * path — the registration's admin directory, or failing that its head. It is
 * what binds a confirmation to a thing rather than to a location (round-1 B5).
 */
export interface ResolvedTarget {
  repoPath: string;
  worktreePath: string;
  incarnation: string;
  locked: boolean;
  wasRegistered: boolean;
  existedOnDisk: boolean;
}

/**
 * Which scope a notice attaches to. Present for the worktree-scoped verbs and
 * absent for `create` and `prune`, which act on a repository and have no single
 * worktree to hang a result on.
 */
export type MutationOutcome =
  | {
      kind: "ok";
      verb: MutationVerb;
      repoId: string;
      worktreeId?: string;
      openTerminalAt?: string;
      /**
       * The action succeeded and the thing it was asked to do AFTERWARDS did
       * not. Reported on the success rather than as a second outcome, because
       * a follow-up notice sharing this one's scope replaces it (round-4 W7).
       */
      openFailed?: string;
    }
  /**
   * Something is at risk, so the removal has NOT run and is waiting on a
   * confirmation — or can never get one.
   *
   * `fingerprint` is null exactly when the assessment refuses, which is what
   * makes a force against a refusal unrepresentable rather than merely checked.
   */
  | {
      kind: "blocked";
      verb: "remove";
      repoId: string;
      worktreeId: string;
      /** Never `unavailable`: an unreadable assessment is its own outcome. */
      assessment: Exclude<RemovalAssessment, { kind: "unavailable" }>;
      fingerprint: string | null;
    }
  | { kind: "unavailable"; verb: MutationVerb; repoId: string; worktreeId?: string; unreadable: readonly string[] }
  | { kind: "error"; verb: MutationVerb; repoId: string; worktreeId?: string; message: string }
  | { kind: "indeterminate"; verb: MutationVerb; repoId: string; worktreeId?: string; observed: string };

export type MutationVerb = "create" | "remove" | "lock" | "unlock" | "prune";

/**
 * What a rejected `stat` of the journalled path proves.
 *
 * `false` only for the two codes that mean the path is not there. Every other
 * rejection — EACCES, EIO, ELOOP, a revoked mount — means we could not look,
 * and `null` is what `observeAfter` passes on as indeterminate. Reading them
 * all as absence let an unreadable filesystem authorize "the removal
 * succeeded" on the one irreversible verb (round-3 B13).
 */
export function existenceFromStatError(error: NodeJS.ErrnoException): false | null {
  return error.code === "ENOENT" || error.code === "ENOTDIR" ? false : null;
}

/** The fields of a worktree record that answer D3's conditions 1 and 4. */
export interface RepairListingRecord {
  displayPath: string;
  branch?: string;
  prunable: boolean;
}

/** The record for this exact path and branch, or undefined when the listing has none. */
async function recordFor(
  records: readonly RepairListingRecord[],
  repairPath: string,
  branch: string,
  normalize: (raw: string) => Promise<string | null>,
): Promise<RepairListingRecord | undefined> {
  const target = normalizePathForCompare(repairPath);
  let found: RepairListingRecord | undefined;
  for (const record of records) {
    if (record.branch !== branch) {
      continue;
    }
    const resolved = await normalize(record.displayPath);
    if (resolved === null || normalizePathForCompare(resolved) !== target) {
      continue;
    }
    // Two records for one path and branch is a listing nobody can reason about,
    // and picking one would be a guess. Answered as "no record" so the caller
    // fails closed rather than repairing against an ambiguous identity — and
    // answered on the SECOND, rather than by collecting every match first
    // (round-4 S1).
    if (found !== undefined) {
      return undefined;
    }
    found = record;
  }
  return found;
}

/** Whether the listing still carries the stale registration a repair was offered for. */
async function holdsStaleRegistration(
  records: readonly RepairListingRecord[],
  repairPath: string,
  branch: string,
  normalize: (raw: string) => Promise<string | null>,
): Promise<boolean> {
  const target = normalizePathForCompare(repairPath);
  for (const record of records) {
    if (!record.prunable || record.branch !== branch) {
      continue;
    }
    const resolved = await normalize(record.displayPath);
    if (resolved !== null && normalizePathForCompare(resolved) === target) {
      return true;
    }
  }
  return false;
}

/** Why a re-corroborated repair was refused, in the user's terms. */
function declineReason(verdict: ReattachVerdict): string {
  if (verdict.kind === "adopt") {
    return "That worktree's administrative entry is gone, so it can no longer be repaired in place.";
  }
  if (verdict.kind === "declined" && verdict.because === "unreadable") {
    return "That directory's git link could not be read, so nothing was repaired.";
  }
  if (verdict.kind === "declined" && verdict.because === "notALinkedWorktree") {
    return "That directory is no longer a linked worktree, so nothing was repaired.";
  }
  return "That checkout has moved since it was inspected. Nothing was changed; please try again.";
}

export interface MutationServiceDeps {
  runner: GitCommandRunner;
  /**
   * Force a rebuild of `repoId` and wait for it. The coordinator calls this
   * before resolving and again after every attempt, so resolution never reads a
   * cache the previous mutation invalidated (design.md D12).
   */
  forceRebuild(repoId: string): Promise<void>;
  /** What `worktreeId` names in the CURRENT tree, or null once it is gone. */
  resolve(target: WorktreeMutationTarget): ResolvedTarget | null;
  /** The repository's own path, for the repo-scoped verbs. */
  repoPath(repoId: string): string | null;
  /**
   * The blocker assessment a removal is judged against, re-read at execution.
   *
   * A `refused` assessment carries no evidence BY CONSTRUCTION, which is what
   * makes a force against one unrepresentable rather than merely checked.
   */
  assessRemoval(target: WorktreeMutationTarget): Promise<RemovalAssessment | null>;
  /**
   * The observation the tree currently holds of this repository (design.md D12).
   *
   * Synchronous by contract: the coordinator asks it immediately before it
   * issues a destructive command, and an `await` in there would reopen the very
   * window the question exists to close (round-10 B8).
   */
  observation(repoId: string): number | undefined;
  /**
   * What the rebuilt tree and the filesystem say about the target NOW.
   *
   * Two independent readings, not one: D11 turns on registration and directory
   * disagreeing, so a single "is it still resolvable" answer cannot produce the
   * comparison. `null` when the rebuild could not obtain a listing at all,
   * which is itself indeterminate.
   */
  observeAfter(
    target: WorktreeMutationTarget,
    /** The path recorded BEFORE the spawn. The only path worth statting. */
    journalledPath: string,
  ): Promise<{ isRegistered: boolean; existsOnDisk: boolean } | null>;
  /** Where a create may go, and what already occupies this repo. */
  createContext(repoId: string): CreatePathContext | null;
  pathDeps: CreatePathDeps;
  /**
   * Re-establish D3's conditions 2 and 3 at the mutation, through the SAME
   * probe that offered the repair.
   *
   * Injected rather than reimplemented so the offer and the mutation cannot
   * disagree about what was checked — a second hand-rolled copy of the link and
   * HEAD reads is how they would drift (round-1 B1).
   */
  corroborateRepair(input: { repoPath: string; branch: string; repairPath: string }): Promise<ReattachVerdict>;
  /**
   * The repository's worktrees, from the listing that negotiates `-z`.
   *
   * `null` when no listing could be obtained, which is indeterminate rather
   * than "nothing is registered". D3's conditions 1 and 4 both read this, and
   * they must read it the same way the offer did (round-1 W5).
   */
  listWorktrees(repoPath: string): Promise<readonly RepairListingRecord[] | null>;
  /** Report an outcome to the surface that started it (D17). */
  report(outcome: MutationOutcome, origin?: WorktreeSurface): void;
  /**
   * Everything this action should do once git has succeeded.
   *
   * Takes the whole `WorktreeAfterCreate` rather than a mode plus an optional
   * payload: the launch details live on the `agent` variant, and splitting them
   * apart here would recreate the "does this pairing make sense" question the
   * union exists to answer. `origin` is the surface that asked — only a surface
   * can hold the session a launch creates. A rejection here is the create's
   * `openFailed`, never the create's failure.
   */
  afterCreate(path: string, after: WorktreeAfterCreate, origin?: WorktreeSurface): Promise<void>;
  /** The `.git` dir whose `info/exclude` needs the entry, or null (D8). */
  /**
   * The `.git` directory whose `info/exclude` should hide `createdPath`, plus
   * that path relative to the repository. `null` when the worktree was not
   * created inside the repository, which is the ordinary case.
   *
   * The RELATIVE path is what comes back because `info/exclude` patterns are
   * repo-root-relative; the absolute one this used to pass matched nothing at
   * all, so D8 had never taken effect (round-3 B10).
   */
  gitExcludeDirFor(repoPath: string, createdPath: string): { gitDir: string; relativePath: string } | null;
  addToGitExclude(gitDir: string, entry: string): Promise<void>;
  now(): number;
  fingerprints?: FingerprintStore;
  coordinator?: MutationCoordinator;
}

export interface WorktreeMutationService extends WorktreeMutationCapabilities {
  /** Issue the confirmation token for what the user is about to be shown. */
  issueFingerprint(target: WorktreeMutationTarget, evidence: RemovalEvidence): string | null;
}

export function createWorktreeMutationService(deps: MutationServiceDeps): WorktreeMutationService {
  const fingerprints = deps.fingerprints ?? createFingerprintStore();
  const coordinator =
    deps.coordinator ??
    createMutationCoordinator({
      queue: createMutationQueue(),
      gate: { request: async (repoId) => void (await deps.forceRebuild(repoId)) },
    });

  /**
   * Run `body` against whatever `target` names AFTER the rebuild.
   *
   * The id is carried the whole way rather than resolved at the message
   * boundary: a queued mutation that resolved on arrival would act on a path
   * whose registration may have been replaced while it waited, which for a
   * forced removal means deleting a different worktree than the one confirmed
   * (round-1 B2).
   */
  function withTarget(
    verb: MutationVerb,
    target: WorktreeMutationTarget,
    body: (resolved: ResolvedTarget, ctx: MutationSettle) => Promise<MutationOutcome>,
    missing?: () => Promise<MutationOutcome>,
  ): Promise<void> {
    return coordinator
      .run<ResolvedTarget, MutationOutcome>(target.repoId, {
        resolve: async () => deps.resolve(target),
        body,
        ...(missing === undefined ? {} : { missing }),
      })
      .then(
        // Stamped once, here: every worktree-scoped verb leaves through this
        // wrapper, and a notice with no scope attaches to no row at all.
        (outcome) => deps.report({ ...outcome, worktreeId: target.worktreeId }, target.origin),
        (error: unknown) =>
          deps.report(
            { kind: "error", verb, repoId: target.repoId, worktreeId: target.worktreeId, message: messageOf(error) },
            target.origin,
          ),
      );
  }

  function settled(verb: MutationVerb, repoId: string, result: MutationResult): MutationOutcome {
    return result.ok ? { kind: "ok", verb, repoId } : { kind: "error", verb, repoId, message: result.message };
  }

  return {
    /**
     * Drop the confirmation of every worktree the tree no longer holds.
     *
     * D15 says a confirmation does not survive the disappearance of what it was
     * issued for, and the removal path is only ONE way that disappearance gets
     * observed. A worktree deleted by another window, or by the user in a
     * terminal, is seen by an ordinary watcher-driven rebuild — and until this
     * ran there, a token issued before that deletion stayed live and could
     * authorize destroying whatever was created at the same location next
     * (round-3 B5).
     */
    reconcileFingerprints(presentWorktreeIds: readonly string[]) {
      const present = new Set(presentWorktreeIds);
      for (const worktreeId of fingerprints.worktreeIds()) {
        if (!present.has(worktreeId)) {
          fingerprints.forget(worktreeId);
        }
      }
    },

    issueFingerprint(target, evidence) {
      const resolved = deps.resolve(target);
      if (resolved === null) {
        return null;
      }
      return fingerprints.issue({ worktreeId: target.worktreeId }, evidence, deps.now());
    },

    lockWorktree: (target, reason) =>
      withTarget("lock", target, async (t) =>
        settled("lock", target.repoId, await lockWorktree(deps.runner, { ...paths(t), reason })),
      ),

    unlockWorktree: (target) =>
      withTarget("unlock", target, async (t) =>
        settled("unlock", target.repoId, await unlockWorktree(deps.runner, paths(t))),
      ),

    removeWorktree: (target, force, fingerprint) =>
      withTarget(
        "remove",
        target,
        async (t, ctx) => {
          // Assessed on EVERY removal, forced or not. Gating this behind `force`
          // meant an unforced removal evaluated no blockers at all and went
          // straight to git — and since only the confirmable branch issues a
          // token, nothing ever called `issueFingerprint` either (round-2 B1).
          // Git refuses a dirty worktree itself; idle panes and external sessions
          // are not git's concern and would have been destroyed unannounced.
          // EVERY forced exit spends the token, including the ones below that
          // never reach git. Returning `reprompt` without redeeming left it live
          // after an evidence-read failure, so the next message could retry a
          // removal that may already have run half-way (round-2 B5).
          const spend = (): void => {
            if (force && fingerprint !== undefined) {
              fingerprints.forget(target.worktreeId);
            }
          };

          // A throw is a forced exit too. Every `return` below spends the
          // token; an exception left it live, so the next message could retry a
          // removal whose git call may already have run (round-4 S1).
          // Taken BEFORE the assessment, so the window this closes covers the
          // whole of it as well as the handoff below (round-10 B8).
          const observed = deps.observation(target.repoId);
          const assessment = await deps.assessRemoval(target).catch((error: unknown) => {
            spend();
            throw error;
          });
          if (assessment === null) {
            spend();
            return {
              kind: "error",
              verb: "remove",
              repoId: target.repoId,
              message: "The worktree this action names could not be assessed.",
            };
          }
          if (assessment.kind === "unavailable") {
            spend();
            return { kind: "unavailable", verb: "remove", repoId: target.repoId, unreadable: assessment.unreadable };
          }
          if (assessment.kind === "refused") {
            spend();
            return {
              kind: "blocked",
              verb: "remove",
              repoId: target.repoId,
              worktreeId: target.worktreeId,
              assessment,
              fingerprint: null,
            };
          }

          if (!force) {
            // Nothing at risk is the only case an unforced removal may run.
            // Anything else comes back as the blocker set the user must see,
            // carrying the token that will authorize exactly it.
            if (atRisk(assessment.evidence)) {
              return {
                kind: "blocked",
                verb: "remove",
                repoId: target.repoId,
                worktreeId: target.worktreeId,
                assessment,
                fingerprint: fingerprints.issue({ worktreeId: target.worktreeId }, assessment.evidence, deps.now()),
              };
            }
          } else {
            const verdict =
              fingerprint === undefined
                ? "reprompt"
                : fingerprints.redeem({ worktreeId: target.worktreeId }, fingerprint, assessment.evidence, deps.now());
            if (verdict === "reprompt") {
              return {
                kind: "error",
                verb: "remove",
                repoId: target.repoId,
                message: "What is at risk here changed since you confirmed it. Please review it again.",
              };
            }
          }
          const journal = {
            worktreePath: t.worktreePath,
            wasRegistered: t.wasRegistered,
            existedOnDisk: t.existedOnDisk,
          };
          // The last window, and the one every earlier check depends on: the
          // assessment validated its own observation, but this caller resumes
          // from an `await`, and a rebuild continuation already queued behind it
          // lands first. Asked here, synchronously, with nothing between this
          // line and the command — evidence gathered under one observation must
          // not authorize a command issued under another (round-10 B8).
          if (deps.observation(target.repoId) !== observed) {
            spend();
            return { kind: "unavailable", verb: "remove", repoId: target.repoId, unreadable: ["listing"] };
          }
          const { result, timedOut } = await removeWorktree(deps.runner, {
            ...paths(t),
            force,
            locked: t.locked,
          });
          // The coordinator's own post-attempt rebuild, taken here rather than
          // added to: `classifyRemoval` compares against what the rebuild found,
          // and a third forced rebuild per removal was pure cost (round-3 W5).
          await ctx.settle();
          // The observation D15 names, made at the exact point it happens. The
          // host reconciles after every rebuild too (round-3 B5); this one stays
          // because a removal is where a stale token is most dangerous, and a
          // cache read is not a rebuild.
          if (deps.resolve(target) === null) {
            fingerprints.forget(target.worktreeId);
          }
          return asOutcome(
            "remove",
            target.repoId,
            classifyRemoval({
              journal,
              timedOut,
              result,
              after: await deps.observeAfter(target, journal.worktreePath),
            }),
          );
        },
        // The id resolved to nothing on the far side of the forced rebuild, so
        // the worktree is already gone. That IS D15's observation, and it has to
        // spend the token here: the coordinator used to throw straight past the
        // body, leaving a live confirmation for whatever takes this location
        // next (round-3 B5).
        async () => {
          fingerprints.forget(target.worktreeId);
          return {
            kind: "error",
            verb: "remove",
            repoId: target.repoId,
            worktreeId: target.worktreeId,
            message: "That worktree is already gone.",
          };
        },
      ),

    pruneRepo: (repoId, confirmedCount, origin) => {
      // The count arrives from a webview message. A prune authorized by a
      // number that is not one cannot be re-checked against anything.
      if (!Number.isSafeInteger(confirmedCount) || confirmedCount < 0) {
        deps.report(
          { kind: "error", verb: "prune", repoId, message: "That confirmation did not name a count." },
          origin,
        );
        return Promise.resolve();
      }
      return coordinator
        .run<string, MutationOutcome>(repoId, {
          resolve: async () => deps.repoPath(repoId),
          body: async (repoPath) => {
            // Re-counted inside the queue: the user authorized a NUMBER, and a
            // prune that drops a different one is not what they confirmed.
            const actual = await pruneRepo.countPrunable(deps.runner, repoPath);
            if (!actual.ok) {
              // Unreadable is not zero, and it is not a mismatch either: we
              // cannot say what this prune would drop, so it does not run.
              return { kind: "unavailable", verb: "prune", repoId, unreadable: ["prunable"] };
            }
            if (actual.count !== confirmedCount) {
              return {
                kind: "error",
                verb: "prune",
                repoId,
                message: `There are now ${actual.count} stale registrations, not ${confirmedCount}. Please confirm again.`,
              };
            }
            return settled("prune", repoId, await pruneRepo.run(deps.runner, repoPath));
          },
        })
        .then(
          (outcome) => deps.report(outcome, origin),
          (error: unknown) => deps.report({ kind: "error", verb: "prune", repoId, message: messageOf(error) }, origin),
        );
    },

    createWorktree: async (request) => {
      const fail = (message: string): MutationOutcome => ({
        kind: "error",
        verb: "create",
        repoId: request.repoId,
        message,
      });

      // PHASE 1 — before the queue. D6 wants two observations with the wait
      // BETWEEN them; validating only on the far side is one observation with a
      // wait in front of it, which cannot detect a change because it never saw
      // the earlier state (round-2 B4). This is the "earlier state".
      // Reported after the create's own outcome, never in place of it: the
      // worktree exists whether or not a window opened (round-3 W7).
      let openFailure: string | null = null;

      // Reattach leaves before the create-path check, not inside it.
      //
      // `validateCreatePath` answers "may a worktree be CREATED here", and one
      // of its rules is that the destination is not another worktree of this
      // repository — which the stale registration still is, so every reattach
      // would be refused by the check that exists to protect creates. A repair
      // creates nothing: it rewrites the link to a directory git already
      // registered. Its guard is D3's conditions, re-established below.
      if (request.mode.kind === "reattach") {
        const mode = request.mode;
        return coordinator
          .run<string, MutationOutcome>(request.repoId, {
            resolve: async () => deps.repoPath(request.repoId),
            body: async (repoPath) => {
              const repairPath = await deps.pathDeps.normalize(mode.repairPath);
              const stat = repairPath === null ? null : await deps.pathDeps.lstat(repairPath);
              if (repairPath === null || stat === null || stat.isSymbolicLink() || !stat.isDirectory()) {
                return fail("That directory is gone, so there is nothing to re-register.");
              }
              // D3 condition 1, re-established HERE and not carried from the
              // resolution. If the administrative entry was pruned during the
              // user's pause, `git worktree repair` has nothing to reconnect,
              // exits 0, and the condition-4 check below then asks whether a
              // path nobody registered is still prunable — it is not, so the
              // check passes and a repair that did nothing would be reported as
              // a success. Requiring the stale record BEFORE the command is
              // what makes condition 4 mean what it says (round-1 B1).
              const before = await deps.listWorktrees(repoPath);
              if (before === null) {
                return { kind: "unavailable", verb: "create", repoId: request.repoId, unreadable: ["prunable"] };
              }
              if (!(await holdsStaleRegistration(before, repairPath, mode.branch, deps.pathDeps.normalize))) {
                return fail(
                  "Git no longer reports that directory as a stale registration of this branch, so there is nothing to repair.",
                );
              }
              // D3 conditions 2 and 3, through the same probe that offered the
              // repair: the `.git` link, the administrative directory it names,
              // and the branch tip against the directory's HEAD. The user's
              // decision sits between the read and this mutation, and every one
              // of them can have changed inside that window.
              const verdict = await deps.corroborateRepair({ repoPath, branch: mode.branch, repairPath });
              if (verdict.kind !== "offer") {
                return fail(declineReason(verdict));
              }
              // The probe proves the checkout still matches the branch NOW;
              // this proves it is still the same checkout the user was shown.
              if (verdict.expectedOid !== mode.expectedOid) {
                return fail("That checkout has moved since it was inspected. Nothing was changed; please try again.");
              }
              const result = await repairWorktree(deps.runner, { repoPath, worktreePath: repairPath });
              if (!result.ok) {
                return settled("create", request.repoId, result);
              }
              // § 2.3 condition 4. Git exiting 0 is not the claim; the listing
              // losing `prunable` is, and a repair that did not take is
              // reported rather than announced as a success.
              const after = await deps.listWorktrees(repoPath);
              if (after === null) {
                return { kind: "unavailable", verb: "create", repoId: request.repoId, unreadable: ["prunable"] };
              }
              // Success is the registration STILL BEING THERE and no longer
              // prunable — not the absence of a stale one. Absence is also what
              // a registration pruned between the pre-check and the command
              // looks like, and `repair` no-ops at exit 0 against that, so
              // reading absence as success announced a repair that never
              // happened (round-3 B1).
              const proof = await recordFor(after, repairPath, mode.branch, deps.pathDeps.normalize);
              if (proof === undefined) {
                return {
                  kind: "unavailable",
                  verb: "create",
                  repoId: request.repoId,
                  unreadable: ["prunable"],
                };
              }
              if (proof.prunable) {
                return fail("Git still reports that worktree as stale, so the repair did not take.");
              }
              await deps.afterCreate(repairPath, request.afterCreate, request.origin).catch((error: unknown) => {
                const reason = messageOf(error);
                openFailure = request.afterCreate.kind === "agent" ? `Agent did not start: ${reason}` : reason;
              });
              return {
                kind: "ok",
                verb: "create",
                repoId: request.repoId,
                ...(openFailure === null ? {} : { openFailed: openFailure }),
                ...(request.afterCreate.kind === "terminal" ? { openTerminalAt: repairPath } : {}),
              };
            },
          })
          .then(
            (outcome) => deps.report(outcome, request.origin),
            (error: unknown) => deps.report(fail(messageOf(error)), request.origin),
          );
      }

      const before = deps.createContext(request.repoId);
      if (before === null) {
        deps.report(fail("That repository is gone."), request.origin);
        return;
      }
      // Resolved ONCE and used for both observations. Deriving it separately in
      // each phase would let the two checks disagree about what the destination
      // was supposed to be, which is the one thing the two-phase check exists to
      // detect.
      const intent = intentFor(request.mode, request.disposition);
      const first = await validateCreatePath(request.path, before, deps.pathDeps, intent);
      if (!first.ok) {
        deps.report(fail(first.reason), request.origin);
        return;
      }

      return coordinator
        .run<string, MutationOutcome>(request.repoId, {
          resolve: async () => deps.repoPath(request.repoId),
          body: async (repoPath) => {
            const ctx = deps.createContext(request.repoId);
            if (ctx === null) {
              return fail("That repository is gone.");
            }
            // PHASE 2 — the FULL check again, not a spot-check. Lexical walk,
            // normalization, containment, type and emptiness all re-run here,
            // because any of them can have changed during the wait.
            const check = await validateCreatePath(request.path, ctx, deps.pathDeps, intent);
            if (!check.ok) {
              return fail(check.reason);
            }
            if (check.path !== first.path) {
              // The same input string now normalizes somewhere else, which means
              // something in the ancestry was replaced.
              return fail("That location changed while the action was queued. Please try again.");
            }
            const stat = await deps.pathDeps.lstat(check.recheckPath);
            const moved =
              check.recheckPath !== first.recheckPath ||
              check.mustBeEmpty !== first.mustBeEmpty ||
              identityOf(stat) !== first.recheckIdentity;
            if (moved) {
              return fail("That location changed while the action was queued. Please try again.");
            }
            // Emptiness is re-asked of the CURRENT observation, not inherited
            // from phase 1 — `mustBeEmpty` was never consumed a second time.
            if (check.mustBeEmpty) {
              const entries = await deps.pathDeps.readdir(check.recheckPath);
              if (entries === null || entries.length > 0) {
                return fail("That directory is no longer empty.");
              }
            }
            // Before anything is created: git's own answer, so an invalid name
            // fails as a name rather than as a half-finished worktree (W9).
            const named = branchOf(request.mode);
            if (named !== undefined && (await branchNameIsValid(deps.runner, repoPath, named)) === false) {
              return fail(`Git will not accept "${named}" as a branch name.`);
            }
            const result = await createWorktree(deps.runner, {
              repoPath,
              worktreePath: check.path,
              source: sourceOf(request.mode),
            });
            if (!result.ok) {
              return settled("create", request.repoId, result);
            }
            // D8: a root inside the main worktree must not dirty the parent's
            // status. A failure here is reported, never fatal to the create.
            const exclude = deps.gitExcludeDirFor(repoPath, check.path);
            if (exclude !== null) {
              await deps.addToGitExclude(exclude.gitDir, excludePatternFor(exclude.relativePath));
            }
            // The worktree is already made. Whatever this rejects with, it
            // reports as a launch that did not happen — it never unmakes it.
            await deps.afterCreate(check.path, request.afterCreate, request.origin).catch((error: unknown) => {
              const reason = messageOf(error);
              openFailure = request.afterCreate.kind === "agent" ? `Agent did not start: ${reason}` : reason;
            });
            return {
              kind: "ok",
              verb: "create",
              repoId: request.repoId,
              ...(openFailure === null ? {} : { openFailed: openFailure }),
              // Only a SURFACE can open a terminal — it needs a view id and a
              // webview (D2). The host performs it on the origin.
              ...(request.afterCreate.kind === "terminal" ? { openTerminalAt: check.path } : {}),
            };
          },
        })
        .then(
          (outcome) => deps.report(outcome, request.origin),
          (error: unknown) => deps.report(fail(messageOf(error)), request.origin),
        );
    },
  };
}

/**
 * Anything a confirmation would need to name. A clean worktree has none.
 *
 * Ignored material counts, and so does a walk that could not finish: git refuses
 * a dirty worktree itself and knows nothing about the `node_modules` and copied
 * `.env` this extension provisions, so "unforced ran straight to git" is exactly
 * how those get destroyed unannounced. An unmeasured amount is still an amount
 * the user has to be told about before an irreversible delete — confirmable
 * throughout, never a refusal (worktree-removal.md § 2.3).
 */
function atRisk(e: RemovalEvidence): boolean {
  return (
    e.dirtyPaths.length > 0 ||
    e.untrackedPaths.length > 0 ||
    e.paneIds.length > 0 ||
    e.externalSessionIds.length > 0 ||
    e.locked ||
    e.ignored.kind === "unproven" ||
    e.ignored.entries > 0
  );
}

function paths(t: ResolvedTarget): { repoPath: string; worktreePath: string } {
  return { repoPath: t.repoPath, worktreePath: t.worktreePath };
}

function asOutcome(verb: MutationVerb, repoId: string, outcome: RemovalOutcome): MutationOutcome {
  if (outcome.outcome === "ok") {
    return { kind: "ok", verb, repoId };
  }
  if (outcome.outcome === "error") {
    return { kind: "error", verb, repoId, message: outcome.message };
  }
  return { kind: "indeterminate", verb, repoId, observed: outcome.observed };
}

/**
 * The branch this create would CREATE, or undefined.
 *
 * Only a new branch is checked: an existing branch was already accepted by git
 * when it was made, and a detached create names a revision, not a branch.
 */
function branchOf(mode: WorktreeCreateMode): string | undefined {
  return mode.kind === "fresh" ? mode.branch : undefined;
}

/**
 * The wire mode, in git's own vocabulary. A TOTAL map, with no inference.
 *
 * This used to read the request's optional fields and guess: `newBranch` only
 * when `baseRef` happened to be present, `existingBranch` otherwise. The
 * new-branch and existing-branch modes were indistinguishable on the wire, so
 * the ordinary create — a new branch, no base ref — became
 * `git worktree add <path> <branch>` against a branch nobody had made, and git
 * answered `fatal: invalid reference`. There is nothing left here to guess with.
 *
 * `reattach` and `adopt` are not `git worktree add` at all; they throw rather
 * than resolve, and WT-012.15 is where they get their own commands.
 */
function sourceOf(mode: WorktreeCreateMode): CreateSource {
  switch (mode.kind) {
    case "fresh":
      return {
        kind: "newBranch",
        branch: mode.branch,
        ...(mode.baseRef === undefined ? {} : { baseRef: mode.baseRef }),
      };
    case "fresh-detached":
      return { kind: "detached", ref: mode.baseRef };
    case "reuse":
      return { kind: "existingBranch", branch: mode.branch };
    case "reattach":
    case "adopt":
      throw new Error(`"${mode.kind}" is not a git worktree add; it has no CreateSource.`);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
