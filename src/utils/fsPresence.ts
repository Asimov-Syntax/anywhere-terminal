// src/utils/fsPresence.ts — which filesystem failures prove a path is not there.
//
// One definition, because the answer decides whether a caller may report absence.
// Reporting "not there" from a check that merely failed is how a live session's
// row loses its preview (tell-an-absent-session-from-an-unknown-one D2, D6).

/** What a presence check could establish about a path. */
export type FsPresence = "present" | "absent" | "unreachable";

/**
 * ENOENT and ENOTDIR prove the path is not there — a missing entry, and a path
 * whose parent is not a directory. Everything else (EACCES, EPERM, EIO, ELOOP, a
 * dead mount) says only that this process could not find out, and MUST NOT be
 * reported as absence.
 */
export function presenceFromAccessError(err: unknown): FsPresence {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR" ? "absent" : "unreachable";
}

/** True only for a failure that PROVES absence — the guard a scan uses to decide
 *  whether it may still call itself exhaustive. */
export function provesAbsence(err: unknown): boolean {
  return presenceFromAccessError(err) === "absent";
}
