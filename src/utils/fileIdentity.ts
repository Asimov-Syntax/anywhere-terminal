// src/utils/fileIdentity.ts — Whether two stats describe the same file.
//
// One predicate rather than two, because the two callers that need it — the
// locked write's ownership decisions and the no-follow leaf read — must agree
// about precision forever. Read as a double, `ino` values at and above 2^53
// collide, so 2^53 and 2^53+1 name one file and a DIFFERENT leaf can be
// unlinked as an owned one.

/** A `dev`/`ino` pair, from a stat read at either precision. */
export interface FileIdentity {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
}

/**
 * The coercion is what lets a caller compare a bigint stat against a plain one
 * — an injected dependency, mostly. It cannot RECOVER precision a rounded
 * capture already lost; capturing `{ bigint: true }` is what does that.
 */
export function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return BigInt(left.dev) === BigInt(right.dev) && BigInt(left.ino) === BigInt(right.ino);
}
