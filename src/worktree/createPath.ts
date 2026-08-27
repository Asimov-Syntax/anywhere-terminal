// src/worktree/createPath.ts — Where a new worktree goes, and whether the path
// the caller asked for may be used (design.md D6, D7).
//
// Create is the ONE action with no host-issued id to re-resolve from, so this
// validation is the only barrier between a webview-supplied string and git.

import * as nodePath from "node:path";
import { isPathInside } from "../utils/pathBoundary";

export interface CreatePathDeps {
  platform: NodeJS.Platform;
  /** `null` when the path does not exist. */
  lstat(p: string): Promise<LstatLike | null>;
  /** Directory entries, or `null` when `p` is not a readable directory. */
  readdir(p: string): Promise<string[] | null>;
  /** `normalizeWorktreePath` — resolves symlinks via the nearest existing ancestor. */
  normalize(raw: string): Promise<string | null>;
}

/**
 * What `fs.lstat` gives us, narrowed to what this module reads.
 *
 * `dev`/`ino` are the filesystem's own identity for the entry, and they are the
 * only thing that distinguishes "the directory I validated" from "a different
 * empty directory now standing at that path" (round-1 B4).
 */
export interface LstatLike {
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
  dev: number;
  ino: number;
}

/**
 * A comparable filesystem identity, or `null` when this platform does not
 * supply one.
 *
 * NAMED rather than assumed: on Windows `ino` is 0 for many volumes and
 * handle-derived elsewhere, so a `dev:ino` pair there is not a stable identity
 * and pretending otherwise would either refuse every valid create or, worse,
 * accept a substitution because two zeroes compared equal. A `null` identity
 * means the re-check falls back to existence and emptiness alone — the residual
 * proposal.md:49-50 already declares unsupported, now stated where it bites.
 */
export function identityOf(stat: LstatLike | null): string | null {
  if (stat === null || stat.ino === 0) {
    return null;
  }
  return `${stat.dev}:${stat.ino}`;
}

export interface CreatePathContext {
  mainWorktree: string;
  /** Linked worktrees only; a path inside MAIN is allowed. */
  linkedWorktrees: readonly string[];
}

export type CreatePathResult =
  | {
      ok: true;
      /** Normalized, and what git will be given. */
      path: string;
      /**
       * What to re-check immediately before spawning: the candidate itself when
       * it already exists, otherwise its nearest existing ancestor.
       */
      recheckPath: string;
      /** Whether `recheckPath` must still be empty at the re-check. */
      mustBeEmpty: boolean;
      /**
       * The identity `recheckPath` had at validation, or `null` where the
       * platform has none. A re-check that finds a different identity must
       * refuse: the directory was replaced between the two observations.
       */
      recheckIdentity: string | null;
    }
  | { ok: false; reason: string };

/**
 * ORDER IS THE POINT. `normalizeWorktreePath` realpaths the nearest existing
 * ancestor (worktree-model.md:88-89), so normalizing first RESOLVES AWAY the
 * symlink this function exists to reject: `/safe/link/new` becomes the link's
 * target and the component walk never encounters `link`. The lexical walk
 * therefore runs before the normalizer, on the path exactly as supplied.
 */
export async function validateCreatePath(
  raw: string,
  ctx: CreatePathContext,
  deps: CreatePathDeps,
): Promise<CreatePathResult> {
  const api = deps.platform === "win32" ? nodePath.win32 : nodePath.posix;
  if (raw.trim().length === 0 || !api.isAbsolute(raw)) {
    return { ok: false, reason: "The worktree path must be absolute." };
  }
  // Rejected before anything reads or writes this path. A control character is
  // never something a user meant to type, and a newline in particular turns
  // one create into two `info/exclude` rules — a webview message hiding files
  // it was never shown (round-3 B10). NUL also truncates the path at the
  // syscall boundary, so what git receives would not be what was validated.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    return { ok: false, reason: "The worktree path contains a character that is not allowed." };
  }

  // 1. Lexical component walk, BEFORE any resolution.
  const symlinked = await firstSymlinkedComponent(raw, api, deps);
  if (symlinked !== null) {
    return { ok: false, reason: `“${symlinked}” is a symbolic link, so it cannot hold a worktree.` };
  }

  // 2. Now normalize, for identity and containment only.
  const normalized = await deps.normalize(raw);
  if (normalized === null) {
    return { ok: false, reason: "The worktree path could not be resolved." };
  }

  // 3. Absent, or an empty directory.
  const stat = await deps.lstat(normalized);
  if (stat !== null) {
    if (!stat.isDirectory()) {
      return { ok: false, reason: "That path already exists and is not a directory." };
    }
    const entries = await deps.readdir(normalized);
    if (entries === null || entries.length > 0) {
      return { ok: false, reason: "That directory already exists and is not empty." };
    }
  }

  // 4. Not the main worktree, and not inside a LINKED one. Inside MAIN is
  //    allowed — that is where the default root lives (worktree-rpc.md:202).
  if (normalized === ctx.mainWorktree) {
    return { ok: false, reason: "That is the repository's main worktree." };
  }
  for (const linked of ctx.linkedWorktrees) {
    if (normalized === linked || isPathInside(normalized, linked)) {
      return { ok: false, reason: "That path is inside another worktree of this repository." };
    }
  }

  // 5. What the pre-spawn re-check watches. When the candidate already exists,
  //    the nearest EXISTING ancestor is the candidate — recording its parent
  //    would leave a swap of the candidate directory itself undetected.
  const exists = stat !== null;
  const recheckPath = exists ? normalized : await nearestExistingAncestor(normalized, api, deps);
  return {
    ok: true,
    path: normalized,
    recheckPath,
    mustBeEmpty: exists,
    recheckIdentity: identityOf(exists ? stat : await deps.lstat(recheckPath)),
  };
}

async function firstSymlinkedComponent(
  raw: string,
  api: nodePath.PlatformPath,
  deps: CreatePathDeps,
): Promise<string | null> {
  // The ROOT is not a component and must not be walked through as one. On
  // win32 `api.sep` is a backslash, so splitting `C:\\safe\\link` and starting
  // from a bare separator probes `\\C:` — a path that never exists, so the walk
  // returns null on its first step and the barrier fails OPEN on exactly the
  // platform it was meant to guard. `parse().root` keeps `C:\\`, `\\\\server\\share\\`,
  // or `/` intact (round-1 B3).
  // And the SEPARATOR is the platform's, not both. Splitting on both everywhere
  // broke POSIX, where a backslash is a legal filename character: `foo\bar` is
  // ONE directory, and splitting it into two probes `/safe/foo`, which does not
  // exist, so the walk returns early and never reaches the real symlink further
  // down — the same fail-open this function exists to prevent, moved to the
  // platform that was previously correct (round-2 B3).
  const root = api.parse(raw).root;
  const parts = raw
    .slice(root.length)
    .split(api === nodePath.win32 ? /[\\/]/ : "/")
    .filter((p) => p.length > 0);
  let current: string = root;
  for (const part of parts) {
    current = api.join(current, part);
    const stat = await deps.lstat(current);
    if (stat === null) {
      // Segments that do not exist yet cannot be lstat'ed, and neither can
      // anything below them. The residual race this leaves is stated in D6
      // rather than papered over.
      return null;
    }
    if (stat.isSymbolicLink()) {
      return current;
    }
  }
  return null;
}

async function nearestExistingAncestor(p: string, api: nodePath.PlatformPath, deps: CreatePathDeps): Promise<string> {
  let current = api.dirname(p);
  while (true) {
    if ((await deps.lstat(current)) !== null) {
      return current;
    }
    const parent = api.dirname(current);
    if (parent === current) {
      return current;
    }
    current = parent;
  }
}

export interface CreateRootInput {
  /** The setting, and whether the user actually stated it. */
  configured: { value: string | undefined; explicitlySet: boolean };
  linkedWorktrees: readonly string[];
  mainWorktree: string;
  /**
   * Defaults to the running platform. Joining and splitting a Windows layout
   * with the POSIX API produced roots with mixed separators, which git then
   * refused (round-1 B3).
   */
  platform?: NodeJS.Platform;
}

export const DEFAULT_CREATE_ROOT = ".claude/worktrees";

/**
 * Precedence per worktree-actions.md § 3.2. "Explicitly set" is read from the
 * configuration's own resolution, never by comparing against the declared
 * default — a user who deliberately sets the default value has still stated a
 * preference, and must outrank detection.
 */
export function resolveCreateRoot(input: CreateRootInput): string {
  const api = (input.platform ?? process.platform) === "win32" ? nodePath.win32 : nodePath.posix;
  if (input.configured.explicitlySet && input.configured.value !== undefined) {
    return absolutize(input.configured.value, input.mainWorktree, api);
  }
  const detected = modeOfParents(input.linkedWorktrees, api);
  if (detected !== null) {
    return detected;
  }
  return absolutize(DEFAULT_CREATE_ROOT, input.mainWorktree, api);
}

function absolutize(root: string, mainWorktree: string, api: nodePath.PlatformPath): string {
  return nodePath.posix.isAbsolute(root) || nodePath.win32.isAbsolute(root) ? root : api.join(mainWorktree, root);
}

/**
 * The most common parent directory of the repo's linked worktrees. The ROOT
 * only, never the naming pattern: one root can hold worktrees named two ways,
 * and inferring a pattern from them would encode one tool's convention as the
 * repository's.
 */
function modeOfParents(linked: readonly string[], api: nodePath.PlatformPath): string | null {
  if (linked.length === 0) {
    return null;
  }
  const counts = new Map<string, number>();
  for (const w of linked) {
    const parent = api.dirname(w);
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [parent, count] of counts) {
    if (count > bestCount) {
      best = parent;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The free path the form will show. Offering a taken one would state a
 * destination the create is going to refuse.
 */
export function suggestFreePath(
  root: string,
  name: string,
  isTaken: (candidate: string) => boolean,
  platform: NodeJS.Platform = process.platform,
): string {
  const api = platform === "win32" ? nodePath.win32 : nodePath.posix;
  const base = api.join(root, name);
  if (!isTaken(base)) {
    return base;
  }
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!isTaken(candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now()}`;
}
