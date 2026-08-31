// src/worktree/debrisAuthorization.ts — Binds a clearance to the debris the user
// actually saw.
// See: asimov/changes/clear-crash-debris-under-an-explicit-authorization/design.md D2
//
// A sibling of `worktreeFingerprint.ts`, not a generalization of it: that module
// IS its `RemovalEvidence` comparison, and debris shares none of it. What is
// shared is the TTL, imported rather than redeclared.
//
// Taken over the entry NAMES, not a count — the same reason removal takes
// identities. Twelve files are still twelve files after one is replaced by
// another, and the replacement is the one nobody confirmed.

import { createHash } from "node:crypto";
import { FINGERPRINT_TTL_MS } from "./worktreeFingerprint";

export type DebrisVerdict = "proceed" | "reprompt";

/** What was found at the path, as the user was shown it. */
/**
 * The issuer's answer: a token over what it read, or which question failed.
 *
 * Discriminated rather than nullable — "this holds a repository" and "this could
 * not be read" are different answers, and collapsing them told a user whose
 * permissions failed that their directory holds a repository (round-1 W1).
 * Declared here rather than beside either caller so the host and the mutation
 * service share ONE definition of it.
 */
export type DebrisIssueResult =
  | { ok: true; fingerprint: string; entries: readonly string[] }
  | { ok: false; because: "notDebris" | "unreadable" };

export interface DebrisEvidence {
  /** Immediate entry names. Order is not significant; the comparison is a set. */
  readonly entries: readonly string[];
  /**
   * Device and inode, or `null` where the platform has none.
   *
   * `null` is NOT a wildcard. A recorded `null` matches only another `null`,
   * because "we could not tell which directory this was" cannot establish that
   * this is the same one.
   */
  readonly identity: string | null;
}

export interface DebrisAuthorizationStore {
  /** Issue an authorization for the debris the user is about to be shown. */
  issue(resolvedPath: string, evidence: DebrisEvidence, now: number): string;
  /**
   * Spend `token` against `current` — at most once.
   *
   * Consumes the record whatever the verdict, so one authorization is one
   * attempt. A retry after a refusal or a partial clearance is confirmed again,
   * because by then what is on disk is exactly what the failed attempt changed.
   */
  redeem(resolvedPath: string, token: string, current: DebrisEvidence, now: number): DebrisVerdict;
  /** Drop anything this path authorized. */
  forget(resolvedPath: string): void;
  /** Records held — one per path, replaced rather than appended. */
  size(): number;
}

interface Issued {
  token: string;
  evidence: DebrisEvidence;
  issuedAt: number;
}

export function createDebrisAuthorizationStore(): DebrisAuthorizationStore {
  const issued = new Map<string, Issued>();

  /** Refusing an expired record is not the same as releasing it (fingerprint round-1 W2). */
  function evictExpired(now: number): void {
    for (const [key, record] of issued) {
      if (now - record.issuedAt > FINGERPRINT_TTL_MS) {
        issued.delete(key);
      }
    }
  }

  return {
    issue(resolvedPath, evidence, now) {
      evictExpired(now);
      const token = digest(resolvedPath, evidence);
      issued.set(resolvedPath, { token, evidence, issuedAt: now });
      return token;
    },

    redeem(resolvedPath, token, current, now) {
      evictExpired(now);
      const record = issued.get(resolvedPath);
      // Spent on sight, refusals included — a token that survived being refused
      // could be replayed against the next reading that happens to satisfy it.
      issued.delete(resolvedPath);
      if (record === undefined || record.token !== token) {
        return "reprompt";
      }
      return covers(current, record.evidence) ? "proceed" : "reprompt";
    },

    forget(resolvedPath) {
      issued.delete(resolvedPath);
    },

    size() {
      return issued.size;
    },
  };
}

/**
 * Is everything at risk NOW inside what was approved?
 *
 * Strictly less is fine — an entry that vanished is one the clearance no longer
 * has to remove. Anything that APPEARED was never named, and a crash-debris
 * directory can still have a process writing into it, which is exactly the case
 * a delete must not sweep up unannounced.
 *
 * Identity is compared exactly, not as a subset: it answers a different question
 * — whether this is the same directory at all.
 */
function covers(current: DebrisEvidence, approved: DebrisEvidence): boolean {
  if (current.identity === null || approved.identity === null || current.identity !== approved.identity) {
    return false;
  }
  const allowed = new Set(approved.entries);
  return current.entries.every((entry) => allowed.has(entry));
}

/**
 * Over the path as well as the evidence, so an authorization issued for one
 * destination cannot clear another that happens to hold the same names.
 */
function digest(resolvedPath: string, evidence: DebrisEvidence): string {
  const canonical = JSON.stringify({
    path: resolvedPath,
    entries: [...evidence.entries].sort(),
    identity: evidence.identity,
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}
