// src/worktree/worktreeFingerprint.ts — Binds a confirmation to the risk the
// user actually saw (design.md D3).
//
// Taken over IDENTITIES, not counts. `dirty: true` survives README.md being
// cleaned and .env going dirty; `idlePanes: 1` survives pane A closing and pane
// B opening. Every count would compare equal-or-smaller and the force would
// proceed against files and panes nobody confirmed.

import { createHash } from "node:crypto";
import type { IgnoredMaterial } from "./ignoredMaterial";
import type { RemovalEvidence } from "./worktreeBlockers";

/** Long enough to read a confirmation, short enough that stale state cannot act. */
export const FINGERPRINT_TTL_MS = 2 * 60 * 1000;

/**
 * What a redemption returns.
 *
 * `proceed` carries the evidence issued alongside the fingerprint — not
 * `current`, and not a fresh re-assessment — so a guard reading it can never
 * be handed OIDs the user was not shown (design.md D10). A sibling of
 * `debrisAuthorization.ts`'s `DebrisVerdict`, which already answers this way.
 */
export type FingerprintVerdict = { kind: "reprompt" } | { kind: "proceed"; approved: RemovalEvidence };

/**
 * WHICH worktree. And only that — see `forget`.
 *
 * An earlier revision carried an `incarnation` here, meaning to bind the token
 * to a particular registration rather than to a path. Nothing available could
 * actually do that job: `head:branch` repeats when a worktree is recreated on
 * the same commit, and git reuses `.git/worktrees/<name>` whenever the name is
 * free again — which is exactly the recreate case. A field that cannot be made
 * unique is worse than no field, because it reads as a binding that holds
 * (round-2 B5). The binding lives in `forget` instead.
 */
export interface FingerprintTarget {
  worktreeId: string;
}

export interface FingerprintStore {
  /** Issue a fingerprint for what the user is about to be shown. */
  issue(target: FingerprintTarget, evidence: RemovalEvidence, now: number): string;
  /**
   * Spend `fingerprint` against `current` — at most once.
   *
   * Redeeming CONSUMES the record whatever the verdict, so one confirmation
   * authorizes one attempt. A retry after an error, a timeout, or an
   * `indeterminate` outcome must be confirmed again, because by then the
   * evidence the user read is exactly what the failed attempt may have changed.
   *
   * `current` gates whether the redemption proceeds; it never supplies what
   * the caller acts on. The `proceed` verdict answers with the evidence
   * ISSUED, so a caller guarding a delete against a proven pair of OIDs reads
   * the pair the user was shown, never one re-derived after the fact — a
   * branch that moved between issue and redemption is still described by its
   * old OID, which is what lets the guard it feeds refuse rather than
   * substitute (design.md D10).
   */
  redeem(target: FingerprintTarget, fingerprint: string, current: RemovalEvidence, now: number): FingerprintVerdict;
  /**
   * This worktree was observed to be ABSENT — drop anything it authorized.
   *
   * This is what binds a confirmation to one incarnation, and it does it by
   * watching for the event rather than by naming the thing: a worktree created
   * later at the same path cannot inherit a token, because the disappearance
   * that necessarily preceded it already destroyed the token. Called from the
   * rebuild that fails to find the id.
   */
  forget(worktreeId: string): void;
  /** Every worktree currently holding a confirmation. */
  worktreeIds(): readonly string[];
  /** Entries held — one per worktree, replaced rather than appended. */
  size(): number;
}

interface Issued {
  fingerprint: string;
  evidence: RemovalEvidence;
  issuedAt: number;
}

export function createFingerprintStore(): FingerprintStore {
  const issued = new Map<string, Issued>();

  /**
   * Drop what can no longer authorize anything.
   *
   * Refusing an expired record is not the same as releasing it: the store is
   * held for the host's lifetime and would otherwise grow by one full evidence
   * set per worktree ever confirmed (round-1 W2). Swept on every access, which
   * is bounded by the number of live worktrees rather than by history.
   */
  function evictExpired(now: number): void {
    for (const [key, record] of issued) {
      if (now - record.issuedAt > FINGERPRINT_TTL_MS) {
        issued.delete(key);
      }
    }
  }

  return {
    issue(target, evidence, now) {
      evictExpired(now);
      const fingerprint = digest(target, evidence);
      // Replaced, not appended: a worktree has one confirmation in flight.
      issued.set(target.worktreeId, { fingerprint, evidence, issuedAt: now });
      return fingerprint;
    },

    redeem(target, fingerprint, current, now) {
      evictExpired(now);
      const record = issued.get(target.worktreeId);
      // Spent on sight. Every exit below is a spend, including the refusals —
      // a token that survived being refused could be replayed against the next
      // evidence set that happens to satisfy it.
      issued.delete(target.worktreeId);
      if (record === undefined || record.fingerprint !== fingerprint) {
        return { kind: "reprompt" };
      }
      return isIdentityPreservingSubset(current, record.evidence)
        ? { kind: "proceed", approved: record.evidence }
        : { kind: "reprompt" };
    },

    forget(worktreeId) {
      issued.delete(worktreeId);
    },

    worktreeIds() {
      return [...issued.keys()];
    },
    size() {
      return issued.size;
    },
  };
}

/**
 * Every identity at risk NOW must have been at risk in the set the user
 * approved. Strictly less is fine — that is the case the design wants to let
 * through — but anything that appeared, including a replacement at equal count,
 * was never confirmed.
 */
function isIdentityPreservingSubset(current: RemovalEvidence, approved: RemovalEvidence): boolean {
  return (
    isSubset(current.dirtyPaths, approved.dirtyPaths) &&
    isSubset(current.untrackedPaths, approved.untrackedPaths) &&
    isSubset(current.paneIds, approved.paneIds) &&
    isSubset(current.externalSessionIds, approved.externalSessionIds) &&
    // A lock APPEARING is growth; one released is a shrink.
    (!current.locked || approved.locked) &&
    ignoredWithin(current.ignored, approved.ignored)
  );
}

/**
 * The one risk with no identities to compare, so it is compared by its OUTCOME
 * first and then by both of its magnitudes.
 *
 * Outcome first because that is what the spec is written in: a check that was
 * not failing when the user confirmed and is failing now re-prompts, and
 * `unproven` is not failing. So an approved unproven reading covers a current
 * unproven one and a measured nothing, but never a measured failure — the
 * earlier revision let a token that said only "the ignored content could not be
 * read" authorize deleting four thousand files nobody had counted (round-1 B1).
 *
 * Magnitudes second, and bytes as well as entries, because entries alone
 * repeats the failure this module exists to prevent: twelve files are still
 * twelve files after one of them becomes a gigabyte, and the size is what the
 * user weighed.
 *
 * A reading that BECAME unmeasurable is also outside one the user saw — "we can
 * no longer tell" is an unbounded amount the confirmation never named.
 */
function ignoredWithin(current: IgnoredMaterial, approved: IgnoredMaterial): boolean {
  // Not a failure, so there is nothing here the user has not already weighed.
  if (current.kind === "measured" && current.entries === 0) {
    return true;
  }
  if (approved.kind === "unproven") {
    return current.kind === "unproven";
  }
  return current.kind === "measured" && current.entries <= approved.entries && current.bytes <= approved.bytes;
}

function isSubset(current: readonly string[], approved: readonly string[]): boolean {
  const allowed = new Set(approved);
  return current.every((item) => allowed.has(item));
}

/**
 * Over the worktree id as well as the evidence, so a fingerprint issued for one
 * worktree cannot authorize the removal of another that happens to look alike.
 * Same-path RECREATION is not this function's job — see `forget`.
 */
function digest(target: FingerprintTarget, e: RemovalEvidence): string {
  const canonical = JSON.stringify({
    worktreeId: target.worktreeId,
    dirty: [...e.dirtyPaths].sort(),
    untracked: [...e.untrackedPaths].sort(),
    panes: [...e.paneIds].sort(),
    external: [...e.externalSessionIds].sort(),
    locked: e.locked,
    ignored: e.ignored,
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}
