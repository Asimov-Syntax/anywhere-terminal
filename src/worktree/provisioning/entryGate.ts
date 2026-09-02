// src/worktree/provisioning/entryGate.ts — what an entry has to survive before
// anything opens a file descriptor for it (design.md D4, D7).
//
// Two roots, checked separately: the SOURCE must resolve inside the main
// checkout, the DESTINATION inside the new worktree. A single "inside the
// repository" test admits a source that is really a destination, and a
// destination whose existing parent resolves out of the new worktree
// (worktree-apply.md § 2.1).
//
// This module defines no containment predicate. `isResolvedPathInsideRoot` from
// src/utils/resolvedPathBoundary.ts is the one definition, and the resolved form
// is the right one here because the answer authorizes a read or a write
// (DESIGN.md § 9 D31).
//
// Nothing here touches the filesystem except to ask that predicate where a path
// lands. A refusal returns a reason and no path — never a path adjusted to bring
// it back inside a root, which would turn a suspicious entry into a silently
// different one.

import path from "node:path";
import type { ProvisionEntry } from "../../types/messages";
import { isWindowsAbsPath } from "../../utils/pathBoundary";
import {
  isResolvedPathInsideRoot,
  type PreparedRoot,
  prepareResolvedRoot,
  type ResolvedPathInsideDeps,
} from "../../utils/resolvedPathBoundary";
import { foldWin32Name, platformUsesWin32FilenameRules } from "./providerKit";

/** A root an entry's repo-relative spelling joins onto, resolved once for the pass. */
export interface GateRoot {
  readonly path: string;
  readonly prepared: PreparedRoot;
}

export interface EntryGateRoots {
  /** The main checkout: where material is read FROM. */
  readonly source: GateRoot;
  /** The worktree being created: where material is written TO. */
  readonly destination: GateRoot;
}

export type EntryVerdict =
  | { readonly ok: true; readonly source: string; readonly destination: string }
  /**
   * `observedDestination` says whether this refusal was reached AFTER the gate
   * read the filesystem. A name rule and a material rule are decided lexically,
   * so they establish nothing about the destination — only the containment
   * check does (design.md D3a). Without the distinction one member's own rule
   * proves a shared destination occupied and refuses an admissible member
   * beside it (.reviews/round-6.md OOB-F016).
   */
  | { readonly ok: false; readonly reason: string; readonly observedDestination: boolean };

/**
 * Lockfiles this refuses by name.
 *
 * A lockfile copied from main describes MAIN's dependency tree, and the whole
 * point of a per-worktree install is that this branch's lockfile is the
 * authoritative one (worktree-apply.md § 2.1). Matched on the basename, so a
 * lockfile nested in a package is refused like one at the root.
 */
// Lower-cased, and matched lower-cased: macOS and Windows are case-insensitive,
// so `PNPM-LOCK.YAML` names the same file the rule is about (round-2 F004).
const LOCKFILES: ReadonlySet<string> = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "cargo.lock",
  "poetry.lock",
  "gemfile.lock",
  "composer.lock",
]);

const REFUSED_OUTSIDE_SOURCE = "resolves outside the repository it was declared in";
const REFUSED_OUTSIDE_DESTINATION = "resolves outside the worktree being created";

/**
 * Resolve both roots once, for a caller about to check many entries.
 *
 * `null` when either does not resolve: nothing is inside a root that is not
 * there, and saying so once beats saying it per entry.
 */
export async function prepareEntryGate(
  mainCheckout: string,
  worktree: string,
  deps: ResolvedPathInsideDeps = {},
): Promise<EntryGateRoots | null> {
  const [source, destination] = await Promise.all([
    prepareResolvedRoot(mainCheckout, deps),
    prepareResolvedRoot(worktree, deps),
  ]);
  if (source === null || destination === null) {
    return null;
  }
  return {
    source: { path: mainCheckout, prepared: source },
    destination: { path: worktree, prepared: destination },
  };
}

/** Repo-relative means repo-relative. An absolute spelling is refused, not re-rooted. */
function isAbsoluteSpelling(p: string): boolean {
  return p.startsWith("/") || isWindowsAbsPath(p);
}

/**
 * A backslash is never a separator here, and never a filename either.
 *
 * `path.posix.basename("tools\\pnpm-lock.yaml")` is the whole string, so the
 * lockfile and `node_modules` refusals below match nothing — while
 * `path.resolve` on Windows DOES split it, so the entry then lands as
 * `tools/pnpm-lock.yaml` after all. Two Acceptance clauses were bypassable by
 * spelling (round-1 F004). Refused outright rather than normalized: a refusal
 * cannot be half-right about which separator a platform honours.
 */
function hasBackslash(p: string): boolean {
  return p.includes("\\");
}

/**
 * The material-class refusals, checked BEFORE mode is dispatched on so copy and
 * link cannot drift apart (design.md D7).
 *
 * `node_modules` is the one rule that reads mode, because it is a rule about
 * SHARING a dependency tree — which a copy does not do.
 *
 * Classified on the RESOLVED destination, never on the spelling. Round 1 read
 * `path.posix.basename(entry.path)` while admission resolved with
 * `path.resolve`, and every spelling those two disagree about walked straight
 * past the rule: `pnpm-lock.yaml/.` has basename `"."`, `a/../node_modules`
 * has basename `node_modules` only after resolution. Fixing the one spelling a
 * finding quotes leaves the instrument that made it work (round-2 F004), so
 * the rule now reads the same string the walk will write to.
 */
const LOCKFILE_REASON = "a lockfile is never brought over — this branch's own lockfile is the authoritative one";

/**
 * The name the filesystem will act on, whatever spelling addressed it.
 *
 * Case folding was already here. Round 4 found two more spellings that name one
 * object: Win32 strips terminal dots and spaces from a path, and `::$DATA`
 * addresses a file's default data stream — so `pnpm-lock.yaml.` and
 * `pnpm-lock.yaml::$DATA` both open the lockfile while missing the set
 * (.reviews/round-4.md F004).
 *
 * To a fixed point, because the two compose in either order and one pass cannot
 * follow them: `pnpm-lock.yaml::$DATA.` needs the dot stripped before the stream
 * suffix is even visible, and `pnpm-lock.yaml. ::$DATA` needs the reverse.
 * Lower-cased first, so the suffix match does not have to be case-blind twice.
 *
 * All three are Win32 identity and only Win32 identity. On POSIX they are bytes
 * in a name: a Darwin probe held `pnpm-lock.yaml`, `pnpm-lock.yaml.` and
 * `pnpm-lock.yaml::$DATA` at once, three inodes with three different contents,
 * so folding them everywhere refuses a file the material rule was never about
 * (.reviews/round-5.md F028). The case fold stays unconditional — it is a
 * separate question, decided on its own terms, that this round did not reopen.
 *
 * A spelling that folds to nothing matches nothing: the set holds no empty name.
 * This reads the RESOLVED destination and never `entry.path` — a rule over the
 * spelling would refuse `scratch./../.env`, whose offending segment resolution
 * has already discarded, which is the raw-versus-resolved disagreement round-2
 * F004 removed.
 */
function filesystemIdentity(base: string, win32: boolean): string {
  const name = base.toLowerCase();
  // The strip itself lives in `providerKit.ts`: the contender detector needs
  // the same rule for a different reason, and this module used to be the only
  // place it existed (design.md D8).
  return win32 ? foldWin32Name(name) : name;
}

/**
 * The lockfile rule alone, by NAME, for a caller that has no mode to offer.
 *
 * `walk` needs exactly this and nothing else: the `node_modules` rule reads
 * mode because it is about sharing a dependency tree, and a descendant of a
 * copy shares nothing (design.md D6, D7).
 */
export function refusedLockfile(
  resolvedDestination: string,
  win32: boolean = platformUsesWin32FilenameRules(),
): string | null {
  return LOCKFILES.has(filesystemIdentity(path.basename(resolvedDestination), win32)) ? LOCKFILE_REASON : null;
}

function refusedMaterial(resolvedDestination: string, mode: ProvisionEntry["mode"]): string | null {
  // Asked, not repeated. The direct entry and the descendant walk answer the
  // same question, and rounds 2 and 4 were both about those two answers
  // drifting apart — a rule with two maintained sites is the shape that lets
  // them (.reviews/round-5.md F029).
  const lockfile = refusedLockfile(resolvedDestination);
  if (lockfile !== null) {
    return lockfile;
  }
  const base = filesystemIdentity(path.basename(resolvedDestination), platformUsesWin32FilenameRules());
  if (base === "node_modules" && mode === "link") {
    return "node_modules is never linked: a shared tree defeats per-branch lockfiles and corrupts concurrent installs";
  }
  return null;
}

/**
 * Admit an entry, or refuse it with the reason its own rule names.
 *
 * Order matters only in that the cheap, filesystem-free refusals come first: an
 * entry refused by name never causes a resolution.
 */
export async function admitEntry(
  entry: ProvisionEntry,
  roots: EntryGateRoots,
  deps: ResolvedPathInsideDeps = {},
): Promise<EntryVerdict> {
  if (isAbsoluteSpelling(entry.path)) {
    return {
      ok: false,
      reason: "an entry names a path relative to the repository, not an absolute one",
      observedDestination: false,
    };
  }
  // AFTER the absolute check, so a Windows absolute spelling still refuses with
  // the reason that actually describes it rather than with this one.
  if (hasBackslash(entry.path)) {
    return {
      ok: false,
      reason: "a backslash is not a path separator here — declare entries with forward slashes",
      observedDestination: false,
    };
  }

  const source = path.resolve(roots.source.path, entry.path);
  const destination = path.resolve(roots.destination.path, entry.path);

  // Resolution is lexical and touches no filesystem, so this is still ahead of
  // every read — the ordering rule was "no resolution before a name refusal",
  // and `path.resolve` is not one.
  const material = refusedMaterial(destination, entry.mode);
  if (material !== null) {
    return { ok: false, reason: material, observedDestination: false };
  }

  // Both, separately, and both must hold. Checked in parallel because neither
  // answer depends on the other and a refusal names which side failed anyway.
  const [sourceInside, destinationInside] = await Promise.all([
    isResolvedPathInsideRoot(source, roots.source.prepared, deps),
    isResolvedPathInsideRoot(destination, roots.destination.prepared, deps),
  ]);
  if (!sourceInside) {
    return { ok: false, reason: REFUSED_OUTSIDE_SOURCE, observedDestination: true };
  }
  if (!destinationInside) {
    return { ok: false, reason: REFUSED_OUTSIDE_DESTINATION, observedDestination: true };
  }
  return { ok: true, source, destination };
}
