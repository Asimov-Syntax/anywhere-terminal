// src/utils/resolvedPathBoundary.ts — Containment that resolves both sides
// before it answers, for the callers whose answer AUTHORIZES A READ.
//
// Split from ./pathBoundary, which owns the lexical rule and stays free of
// `node:` imports so the webview can share it. The two are not
// interchangeable: see that module's header, and
// asimov/changes/archive/*resolve-containment-through-symlinks*/design.md D8
// for why nothing here may cache a resolved candidate.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { compareBoundary, isWindowsAbsPath } from "./pathBoundary";

/**
 * Separators folded, drive letter lowercased, **every other component left
 * alone** — the normalizer for comparisons that authorize a read.
 *
 * `normalizePathForCompare` lowercases the whole path, which is right when the
 * two sides are worktree ids VS Code spelled differently. It is wrong here:
 * Windows supports case-sensitive directories, so `C:\vault\Store` and
 * `C:\vault\store` can be two places. Both sides of this comparison have been
 * through `realpath`, which returns each component in its canonical on-disk
 * case, so a surviving difference is a REAL difference — folding it could only
 * erase a distinction, never repair one (D7).
 */
function normalizeResolvedForCompare(p: string): string {
  if (!isWindowsAbsPath(p)) {
    return p;
  }
  const slashed = p.replace(/\//g, "\\");
  // The drive letter, and only the drive letter: no filesystem gives it meaning.
  return /^[a-z]:/i.test(slashed) ? slashed[0].toLowerCase() + slashed.slice(1) : slashed;
}

/**
 * Injection seam for the resolved predicate. Tests supply fakes; production
 * takes `node:fs/promises`.
 */
export interface ResolvedPathInsideDeps {
  realpath?: (p: string) => Promise<string>;
  /** Distinguishes "nothing is here" from "a link is here and it dangles". */
  lstat?: (p: string) => Promise<unknown>;
}

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

/** A store root, resolved once and reused for a whole pass over its contents (D8). */
export interface PreparedRoot {
  readonly resolved: string;
}

/**
 * Resolve a store root once, for a caller about to check many candidates against
 * it. `null` when it does not resolve — nothing is inside a root that is not
 * there, and saying so once beats saying it per file.
 */
export async function prepareResolvedRoot(
  root: string,
  deps: ResolvedPathInsideDeps = {},
): Promise<PreparedRoot | null> {
  const realpath = deps.realpath ?? ((p: string) => fs.realpath(p));
  try {
    return { resolved: await realpath(root) };
  } catch {
    return null;
  }
}

/**
 * Is `candidate` STRICTLY inside an already-resolved `root`?
 *
 * Three rules carry the whole point of this predicate, and the first two are the
 * opposite of what the worktree subsystem's `realpathTolerant` does:
 *
 *  1. **Absence is tolerated; failure is not.** A tail that does not exist yet,
 *     beneath a parent that resolved inside the root, is contained — a
 *     transcript that has not been written is the normal early state of a
 *     session. Every other resolution failure refuses. Rebuilding an
 *     unresolvable path lexically is exactly the hole this closes: a dangling
 *     link inside the root would be reconstructed as its literal spelling and
 *     pass, then resolve out of the root the moment its target appears.
 *  2. **Equality is not containment.** Unlike `isPathInside`, a candidate equal
 *     to the root is refused, because every caller here is about to READ the
 *     candidate as a file.
 *  3. **Component case is significant** — see `normalizeResolvedForCompare`.
 *
 * The ROOT is resolved once by the caller; the CANDIDATE resolves on every call,
 * and no answer is cached. A file stamp is not an identity, and a cache keyed on
 * one would let a path that has since become a symlink keep an authorization it
 * earned before (D8).
 */
export async function isResolvedPathInsideRoot(
  candidate: string,
  root: PreparedRoot,
  deps: ResolvedPathInsideDeps = {},
): Promise<boolean> {
  return (await authorizedPathInsideRoot(candidate, root, deps)) !== null;
}

/**
 * The same walk, returning the path it authorized rather than a bare verdict.
 *
 * A caller that passes `candidate` and then builds a destination from
 * `candidate` has built from a value nobody checked: this walk resolves its
 * argument again — deliberately, per the contract above — so **the value it
 * authorized is its own resolution, not the spelling it was handed**. The two
 * coincide on a quiescent filesystem and diverge silently otherwise, which is
 * how that read survived every test until the round-3 plan attack named the
 * state that separates them: a second answer that DIFFERS but stays inside the
 * root is authorized, and only the caller's stale spelling then names the
 * destination (design.md D7 of `write-only-the-native-config-file`).
 *
 * Additive on purpose. `isResolvedPathInsideRoot` keeps its name, signature and
 * every one of its call sites; only a caller that must write through the
 * answer needs this form. Nothing is cached, so the no-stale-authorization
 * contract is untouched.
 *
 * For an absent candidate the value is reconstructed — the resolved ancestor
 * plus the unresolved tail — which is the path a caller's own `mkdir` then
 * creates.
 */
export async function authorizedPathInsideRoot(
  candidate: string,
  root: PreparedRoot,
  deps: ResolvedPathInsideDeps = {},
): Promise<string | null> {
  const realpath = deps.realpath ?? ((p: string) => fs.realpath(p));
  const lstat = deps.lstat ?? ((p: string) => fs.lstat(p));
  const api = isWindowsAbsPath(candidate) || isWindowsAbsPath(root.resolved) ? path.win32 : path.posix;

  const tail: string[] = [];
  let current = candidate;
  for (;;) {
    try {
      const resolved = await realpath(current);
      const full = tail.length === 0 ? resolved : api.join(resolved, ...[...tail].reverse());
      const { same, beneath } = compareBoundary(full, root.resolved, normalizeResolvedForCompare);
      return !same && beneath ? full : null;
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") {
        // ELOOP, EACCES, ENOTDIR — the filesystem declined to answer, so we do
        // not answer for it.
        return null;
      }
      // ENOENT from `realpath` covers two very different things: nothing is
      // here, or something IS here and its link target is not. `lstat` sees the
      // link itself, and a link we cannot follow is refused.
      try {
        await lstat(current);
        return null;
      } catch (lstatError) {
        if (errnoCode(lstatError) !== "ENOENT") {
          return null;
        }
      }
      const parent = api.dirname(current);
      if (parent === current) {
        // Not even the filesystem root resolved. No lexical fallback.
        return null;
      }
      tail.push(api.basename(current));
      current = parent;
    }
  }
}

/**
 * The single-shot form, for a caller with one candidate. A caller with many
 * should prepare the root instead (D8).
 */
export async function isResolvedPathInside(
  candidate: string,
  root: string,
  deps: ResolvedPathInsideDeps = {},
): Promise<boolean> {
  const prepared = await prepareResolvedRoot(root, deps);
  return prepared === null ? false : isResolvedPathInsideRoot(candidate, prepared, deps);
}
